import { Logger } from '@nestjs/common';
import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Cron } from '@nestjs/schedule';
import { Job, Queue } from 'bull';
import { DispatchStatus, ServiceType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { DispatchService } from './dispatch.service';
import { DISPATCH_QUEUE, INITIAL_SEARCH_RADIUS_KM, RADIUS_INCREMENT_KM, MAX_DRIVER_REQUEST_ATTEMPTS } from './constants/dispatch.constants';

@Processor(DISPATCH_QUEUE)
export class DispatchProcessor {
  private readonly logger=new Logger(DispatchProcessor.name);
  constructor(private readonly prisma:PrismaService,private readonly dispatch:DispatchService,@InjectQueue(DISPATCH_QUEUE) private readonly queue:Queue){}

  private async pickup(serviceType:ServiceType,referenceId:string):Promise<{lat:number;lng:number}|null>{
    if(serviceType===ServiceType.FOOD_DELIVERY){
      const order=await this.prisma.foodOrder.findUnique({where:{id:referenceId},include:{restaurant:{select:{latitude:true,longitude:true}}}});
      return order?.restaurant?{lat:order.restaurant.latitude,lng:order.restaurant.longitude}:null;
    }
    if(serviceType===ServiceType.RIDE){const order=await this.prisma.ride.findUnique({where:{id:referenceId},select:{pickupLat:true,pickupLng:true}});return order?{lat:order.pickupLat,lng:order.pickupLng}:null;}
    if(serviceType===ServiceType.VEHICLE_TRANSPORT){const order=await this.prisma.vehicleTransport.findUnique({where:{id:referenceId},select:{pickupLat:true,pickupLng:true}});return order?{lat:order.pickupLat,lng:order.pickupLng}:null;}
    const source=serviceType===ServiceType.PACKAGE_DELIVERY?await this.prisma.package.findUnique({where:{id:referenceId},select:{senderAddress:true}}):await this.prisma.businessShipment.findUnique({where:{id:referenceId},select:{pickupAddress:true}});
    const address=source&&('senderAddress' in source?source.senderAddress:source.pickupAddress) as {lat?:unknown;lng?:unknown}|null;
    const lat=Number(address?.lat),lng=Number(address?.lng);
    return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180?{lat,lng}:null;
  }

  private async find(dispatchId:string){
    const record=await this.prisma.dispatch.findUnique({where:{id:dispatchId},include:{attempts:{select:{driverId:true}}}});
    if(!record||!([DispatchStatus.QUEUED,DispatchStatus.SEARCHING,DispatchStatus.REJECTED,DispatchStatus.TIMED_OUT] as DispatchStatus[]).includes(record.status))return;
    const pickup=await this.pickup(record.serviceType,record.referenceId);
    if(!pickup){await this.prisma.dispatch.update({where:{id:dispatchId},data:{status:DispatchStatus.FAILED,failedAt:new Date(),failReason:'Pickup coordinates unavailable'}});return;}
    const excluded=record.attempts.map(attempt=>attempt.driverId);
    const candidates=await this.dispatch.findNearbyDrivers(pickup.lat,pickup.lng,record.searchRadiusKm,record.serviceType);
    const next=candidates.find(driver=>!excluded.includes(driver.driverId));
    if(next){await this.dispatch.sendJobToDriver(dispatchId,next.driverId);return;}
    const radius=record.searchRadiusKm+RADIUS_INCREMENT_KM;
    if(radius>record.maxRadiusKm||excluded.length>=MAX_DRIVER_REQUEST_ATTEMPTS){await this.prisma.dispatch.update({where:{id:dispatchId},data:{status:DispatchStatus.FAILED,failedAt:new Date(),failReason:'No eligible driver available'}});return;}
    await this.prisma.dispatch.update({where:{id:dispatchId},data:{status:DispatchStatus.SEARCHING,searchRadiusKm:radius}});
    await this.queue.add('find-driver',{dispatchId},{delay:2000});
  }

  @Process('find-driver')
  async findDriver(job:Job<{dispatchId:string}>){await this.find(job.data.dispatchId);}

  @Process('find-next-driver')
  async findNext(job:Job<{dispatchId:string}>){await this.find(job.data.dispatchId);}

  @Process('driver-timeout')
  async timeout(job:Job<{dispatchId:string;attemptId:string;driverId:string}>){
    const attempt=await this.prisma.dispatchAttempt.findUnique({where:{id:job.data.attemptId}});
    const record=await this.prisma.dispatch.findUnique({where:{id:job.data.dispatchId},include:{attempts:{orderBy:{sentAt:'desc'},take:1}}});
    if(!attempt||attempt.respondedAt||!record||record.status!==DispatchStatus.SENT_TO_DRIVER||record.attempts[0]?.id!==attempt.id)return;
    await this.prisma.dispatchAttempt.update({where:{id:attempt.id},data:{accepted:false,respondedAt:new Date(),rejectReason:'Offer expired'}});
    await this.prisma.dispatch.update({where:{id:record.id},data:{status:DispatchStatus.TIMED_OUT}});
    await this.queue.add('find-next-driver',{dispatchId:record.id});
  }

  @Cron('*/30 * * * * *')
  async recoverQueued(){
    const queued=await this.prisma.dispatch.findMany({where:{status:DispatchStatus.QUEUED},select:{id:true},take:100});
    for(const record of queued)await this.queue.add('find-driver',{dispatchId:record.id},{jobId:`recover-${record.id}-${Math.floor(Date.now()/30000)}`});
  }

  @OnQueueFailed()
  failed(job:Job,error:Error){this.logger.error(`Dispatch job ${job.id} failed: ${error.message}`);}
}
