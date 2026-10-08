import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DriverMatchingService } from './matching/driver-matching.service';
import {
  DISPATCH_QUEUE,
  DRIVER_REQUEST_TIMEOUT_SECONDS,
  MAX_DRIVER_REQUEST_ATTEMPTS,
  INITIAL_SEARCH_RADIUS_KM,
  RADIUS_INCREMENT_KM,
  MAX_DISPATCH_RADIUS_KM,
  DISPATCH_JOB_TTL_MS,
} from './constants/dispatch.constants';
import { ServiceType, DispatchStatus, DriverAvailability } from '@prisma/client';

export interface CreateDispatchDto {
  serviceType: ServiceType;
  referenceId: string;
  pickupLat: number;
  pickupLng: number;
  vehicleTypes?: string[];
  strategy?: 'NEAREST_DRIVER' | 'LOWEST_ETA' | 'LOAD_BALANCE';
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private prisma: PrismaService,
    private matchingService: DriverMatchingService,
    @InjectQueue(DISPATCH_QUEUE) private dispatchQueue: Queue,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Start Dispatch ───────────────────────────────────────────────────────
  async startDispatch(dto: CreateDispatchDto) {
    this.logger.log(`Starting dispatch for ${dto.serviceType} ${dto.referenceId}`);

    // Create dispatch record
    const dispatch = await this.prisma.dispatch.create({
      data: {
        serviceType: dto.serviceType,
        referenceId: dto.referenceId,
        status: DispatchStatus.QUEUED,
        searchRadiusKm: INITIAL_SEARCH_RADIUS_KM,
        maxRadiusKm: MAX_DISPATCH_RADIUS_KM,
        strategy: dto.strategy || 'NEAREST_DRIVER',
        startedAt: new Date(),
      },
    });

    // Add to queue
    await this.dispatchQueue.add(
      'find-driver',
      {
        dispatchId: dispatch.id,
        serviceType: dto.serviceType,
        referenceId: dto.referenceId,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        vehicleTypes: dto.vehicleTypes,
        radiusKm: INITIAL_SEARCH_RADIUS_KM,
        attempt: 0,
      },
      {
        delay: 0,
        attempts: MAX_DRIVER_REQUEST_ATTEMPTS,
        timeout: DISPATCH_JOB_TTL_MS,
      },
    );

    this.eventEmitter.emit('dispatch.started', {
      dispatchId: dispatch.id,
      serviceType: dto.serviceType,
      referenceId: dto.referenceId,
    });

    return dispatch;
  }

  // ─── Find Nearby Drivers ──────────────────────────────────────────────────
  async findNearbyDrivers(
    lat: number,
    lng: number,
    radiusKm: number,
    serviceType: ServiceType,
    vehicleTypes?: string[],
  ) {
    return this.matchingService.findNearbyDrivers({
      lat,
      lng,
      radiusKm,
      serviceType,
      vehicleTypes,
    });
  }

  // ─── Send Job to Driver ───────────────────────────────────────────────────
  async sendJobToDriver(dispatchId: string, driverId: string) {
    const timeoutAt = new Date(
      Date.now() + DRIVER_REQUEST_TIMEOUT_SECONDS * 1000,
    );

    const attempt=await this.prisma.$transaction(async tx=>{
      const reserved=await tx.dispatch.updateMany({
        where:{id:dispatchId,status:{in:[DispatchStatus.QUEUED,DispatchStatus.SEARCHING,DispatchStatus.REJECTED,DispatchStatus.TIMED_OUT]}},
        data:{status:DispatchStatus.SENT_TO_DRIVER},
      });
      if(reserved.count!==1)throw new BadRequestException('Dispatch is already assigned or has another active offer');
      return tx.dispatchAttempt.create({data:{dispatchId,driverId,sentAt:new Date(),timeoutAt}});
    });

    // Notify driver via WebSocket
    this.eventEmitter.emit('driver.job_request', {
      driverId,
      dispatchId,
      attemptId: attempt.id,
      timeoutAt,
    });

    // Schedule timeout
    await this.dispatchQueue.add(
      'driver-timeout',
      { dispatchId, attemptId: attempt.id, driverId },
      { delay: DRIVER_REQUEST_TIMEOUT_SECONDS * 1000 },
    );

    return attempt;
  }

  // ─── Accept Job ───────────────────────────────────────────────────────────
  async acceptJob(dispatchId: string, driverId: string, attemptId: string) {
    const dispatch=await this.prisma.$transaction(async tx=>{
      const job=await tx.dispatch.findUnique({where:{id:dispatchId}});
      if(!job||job.status!==DispatchStatus.SENT_TO_DRIVER)throw new BadRequestException('Job is no longer available');
      const attempt=await tx.dispatchAttempt.findFirst({where:{id:attemptId,dispatchId,driverId,respondedAt:null,timeoutAt:{gt:new Date()}}});
      if(!attempt)throw new BadRequestException('This offer is not available to this driver');
      const claimed=await tx.dispatch.updateMany({where:{id:dispatchId,status:DispatchStatus.SENT_TO_DRIVER,assignedDriverId:null},data:{status:DispatchStatus.ACCEPTED,assignedDriverId:driverId,assignedAt:new Date()}});
      if(claimed.count!==1)throw new BadRequestException('Job has already been accepted');
      const ready=await tx.driver.updateMany({where:{id:driverId,status:'APPROVED',availability:DriverAvailability.ONLINE,activeOrderId:null},data:{availability:DriverAvailability.ON_TRIP,activeOrderId:job.referenceId}});
      if(ready.count!==1)throw new BadRequestException('Driver is unavailable');
      await tx.dispatchAttempt.update({where:{id:attemptId},data:{accepted:true,respondedAt:new Date()}});
      return job;
    });

    this.eventEmitter.emit('dispatch.accepted', {
      dispatchId,
      driverId,
      serviceType: dispatch.serviceType,
      referenceId: dispatch.referenceId,
    });

    return { assigned: true, driverId };
  }

  // ─── Reject Job ───────────────────────────────────────────────────────────
  async rejectJob(
    dispatchId: string,
    driverId: string,
    attemptId: string,
    reason?: string,
  ) {
    await this.prisma.$transaction(async tx=>{
      const updated=await tx.dispatchAttempt.updateMany({where:{id:attemptId,dispatchId,driverId,respondedAt:null},data:{accepted:false,respondedAt:new Date(),rejectReason:reason}});
      if(updated.count!==1)throw new BadRequestException('This offer is no longer active');
      const record=await tx.dispatch.updateMany({where:{id:dispatchId,status:DispatchStatus.SENT_TO_DRIVER},data:{status:DispatchStatus.REJECTED}});
      if(record.count!==1)throw new BadRequestException('This dispatch is no longer active');
    });

    // Try next driver
    await this.dispatchQueue.add(
      'find-next-driver',
      { dispatchId, excludeDriverIds: [driverId] },
      { delay: 500 },
    );

    return { rejected: true };
  }

  // ─── Cancel Dispatch ──────────────────────────────────────────────────────
  async cancelDispatch(dispatchId: string) {
    const dispatch = await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: { status: DispatchStatus.FAILED, failedAt: new Date() },
    });

    this.eventEmitter.emit('dispatch.cancelled', { dispatchId });
    return dispatch;
  }

  // ─── Get Dispatch Status ──────────────────────────────────────────────────
  async getDispatchStatus(referenceId: string) {
    return this.prisma.dispatch.findFirst({
      where: { referenceId },
      include: {
        attempts: {
          include: { driver: { include: { user: { select: { name: true, avatar: true } } } } },
          orderBy: { sentAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
