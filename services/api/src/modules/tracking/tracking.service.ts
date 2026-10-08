import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { LocationService } from './services/location.service';
import { EtaService } from './services/eta.service';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private locationService: LocationService,
    private etaService: EtaService,
  ) {}

  async assertAccess(userId: string, role: string, serviceType: string, referenceId: string) {
    let order: {customerId:string;driverId:string|null}|null=null;
    if(serviceType==='FOOD_DELIVERY') order=await this.prisma.foodOrder.findUnique({where:{id:referenceId},select:{customerId:true,driverId:true}});
    if(serviceType==='RIDE') order=await this.prisma.ride.findUnique({where:{id:referenceId},select:{customerId:true,driverId:true}});
    if(serviceType==='PACKAGE_DELIVERY') order=await this.prisma.package.findUnique({where:{id:referenceId},select:{customerId:true,driverId:true}});
    if(!order) throw new NotFoundException('Delivery not found');
    if(['ADMIN','SUPER_ADMIN','SUPPORT_AGENT'].includes(role)||order.customerId===userId)return;
    if(order.driverId){const driver=await this.prisma.driver.findUnique({where:{id:order.driverId},select:{userId:true}});if(driver?.userId===userId)return;}
    throw new ForbiddenException('This delivery belongs to another account');
  }

  async updateDriverLocation(driverId:string, data:{latitude:number;longitude:number;heading?:number;speed?:number}) {
    if(!Number.isFinite(data.latitude)||Math.abs(data.latitude)>90||!Number.isFinite(data.longitude)||Math.abs(data.longitude)>180)throw new BadRequestException('Invalid coordinates');
    const driver=await this.prisma.driver.findUnique({where:{id:driverId},select:{activeOrderId:true,status:true}});
    if(!driver?.activeOrderId||driver.status!=='APPROVED')throw new ForbiddenException('An approved active job is required');
    return this.locationService.updateDriverLocation(driverId,data.latitude,data.longitude,data.heading,data.speed);
  }

  async getTrackingDetails(userId:string, role:string, serviceType: string, referenceId: string) {
    await this.assertAccess(userId,role,serviceType,referenceId);
    let order: any = null;

    if (serviceType === 'FOOD_DELIVERY') {
      order = await this.prisma.foodOrder.findUnique({
        where: { id: referenceId },
        include: {
          restaurant: {
            select: { name: true, address: true, latitude: true, longitude: true },
          },
        },
      });
    } else if (serviceType === 'RIDE') {
      order = await this.prisma.ride.findUnique({
        where: { id: referenceId },
        include: {},
      });
    } else if (serviceType === 'PACKAGE_DELIVERY') {
      order=await this.prisma.package.findUnique({where:{id:referenceId}});
    }

    if (!order) {
      throw new NotFoundException(`Order ${referenceId} not found`);
    }

    const driver=order.driverId?await this.prisma.driver.findUnique({where:{id:order.driverId},select:{currentLat:true,currentLng:true,heading:true,speed:true,lastLocationAt:true}}):null;
    const destination=serviceType==='FOOD_DELIVERY'?order.deliveryAddress:serviceType==='PACKAGE_DELIVERY'?order.receiverAddress:order;
    const dropoffLat=serviceType==='RIDE'?order.dropoffLat:Number(destination?.lat);
    const dropoffLng=serviceType==='RIDE'?order.dropoffLng:Number(destination?.lng);
    const eta=driver?.currentLat!=null&&driver?.currentLng!=null&&Number.isFinite(dropoffLat)&&Number.isFinite(dropoffLng)?this.etaService.calculateEta(driver.currentLat,driver.currentLng,dropoffLat,dropoffLng):null;

    return {
      order,
      eta,
      driverLocation: driver
        ? {
            lat: driver.currentLat,
            lng: driver.currentLng,
            heading: driver.heading,
            speed: driver.speed,
            lastUpdated: driver.lastLocationAt,
          }
        : null,
    };
  }
}
