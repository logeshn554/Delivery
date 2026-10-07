import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { CreateFoodOrderDto } from './dto/create-food-order.dto';
import { OrderStatus, PaymentMethod, ServiceType } from '@prisma/client';
import { generateOrderNumber } from '../../common/utils/generate-number.util';

@Injectable()
export class FoodOrdersService {
  private readonly logger = new Logger(FoodOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private dispatch: DispatchService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(customerId: string, dto: CreateFoodOrderDto) {
    // Verify restaurant is open
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: dto.restaurantId },
      include: { menuItems: { where: { id: { in: dto.items.map(i => i.menuItemId) } } } },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (!restaurant.isOpen) throw new BadRequestException('Restaurant is currently closed');

    // Verify menu items and calculate total
    let subtotal = 0;
    const orderItems = [];

    for (const item of dto.items) {
      const menuItem = restaurant.menuItems.find(m => m.id === item.menuItemId);
      if (!menuItem) throw new BadRequestException(`Menu item ${item.menuItemId} not found`);
      if (!menuItem.isAvailable) throw new BadRequestException(`${menuItem.name} is not available`);

      const itemTotal = menuItem.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        menuItemId: item.menuItemId,
        name: menuItem.name,
        price: menuItem.price,
        quantity: item.quantity,
        addons: item.addons || null,
        totalPrice: itemTotal,
        notes: item.notes,
      });
    }

    // Validate minimum order
    if (subtotal < restaurant.minOrderAmount) {
      throw new BadRequestException(
        `Minimum order amount is ₹${restaurant.minOrderAmount}`,
      );
    }

    // Calculate fees
    const deliveryFee = await this.calculateDeliveryFee(dto.deliveryAddress, restaurant);
    const taxRate = 0.05; // 5% GST
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const tipAmount = dto.tipAmount || 0;
    const totalAmount = subtotal + deliveryFee + taxAmount + tipAmount;

    // Create order
    const order = await this.prisma.foodOrder.create({
      data: {
        orderNumber: generateOrderNumber('FD'),
        customerId,
        restaurantId: dto.restaurantId,
        status: OrderStatus.PENDING,
        deliveryAddress: dto.deliveryAddress as any,
        specialInstructions: dto.specialInstructions,
        subtotal,
        deliveryFee,
        taxAmount,
        tipAmount,
        totalAmount,
        paymentMethod: dto.paymentMethod,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: true,
        restaurant: { select: { name: true, logo: true, phone: true } },
      },
    });

    this.eventEmitter.emit('food_order.created', {
      orderId: order.id,
      customerId,
      restaurantId: dto.restaurantId,
    });

    return order;
  }

  async confirmOrder(orderId: string, restaurantId: string) {
    const order = await this.getOrderOrThrow(orderId);

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not in pending state');
    }

    const updated = await this.prisma.foodOrder.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CONFIRMED,
        estimatedPickupAt: new Date(Date.now() + 20 * 60 * 1000), // 20 min prep
        estimatedDeliveryAt: new Date(Date.now() + 45 * 60 * 1000), // 45 min delivery
      },
    });

    // Start dispatch
    await this.dispatch.startDispatch({
      serviceType: ServiceType.FOOD_DELIVERY,
      referenceId: orderId,
      pickupLat: order.restaurant['latitude'],
      pickupLng: order.restaurant['longitude'],
    });

    this.eventEmitter.emit('food_order.status_updated', {
      orderId,
      status: OrderStatus.CONFIRMED,
      serviceType: ServiceType.FOOD_DELIVERY,
      referenceId: orderId,
      customerId: order.customerId,
    });

    return updated;
  }

  async updateStatus(orderId: string, status: OrderStatus, driverId?: string) {
    const order = await this.getOrderOrThrow(orderId);

    const update: any = { status };

    if (status === OrderStatus.PICKED_UP) update.pickedUpAt = new Date();
    if (status === OrderStatus.DELIVERED) update.deliveredAt = new Date();
    if (driverId) update.driverId = driverId;

    const updated = await this.prisma.foodOrder.update({
      where: { id: orderId },
      data: update,
    });

    this.eventEmitter.emit('order:status_updated', {
      serviceType: ServiceType.FOOD_DELIVERY,
      referenceId: orderId,
      status,
      customerId: order.customerId,
    });

    return updated;
  }

  async cancel(orderId: string, userId: string, reason: string) {
    const order = await this.getOrderOrThrow(orderId);

    const cancellableStatuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED];
    if (!cancellableStatuses.includes(order.status)) {
      throw new BadRequestException('Order cannot be cancelled at this stage');
    }

    const updated = await this.prisma.foodOrder.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledBy: userId,
      },
    });

    this.eventEmitter.emit('food_order.cancelled', {
      orderId,
      customerId: order.customerId,
      reason,
    });

    return updated;
  }

  async findById(orderId: string) {
    return this.prisma.foodOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { menuItem: true } },
        restaurant: { select: { name: true, logo: true, phone: true, latitude: true, longitude: true } },
      },
    });
  }

  async findByCustomer(customerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      this.prisma.foodOrder.findMany({
        where: { customerId },
        include: {
          items: true,
          restaurant: { select: { name: true, logo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.foodOrder.count({ where: { customerId } }),
    ]);

    return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async calculateDeliveryFee(
    deliveryAddress: any,
    restaurant: any,
  ): Promise<number> {
    // Base fee + distance-based fee
    const baseFee = 30;
    // In production, use Google Maps Distance Matrix API
    return baseFee;
  }

  private async getOrderOrThrow(orderId: string) {
    const order = await this.prisma.foodOrder.findUnique({
      where: { id: orderId },
      include: {
        restaurant: { select: { latitude: true, longitude: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
