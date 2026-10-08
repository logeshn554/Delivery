import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { TrackingService } from '../tracking.service';

interface UpdateLocationDto {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

interface JoinRoomDto {
  serviceType: string;
  referenceId: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
  namespace: '/tracking',
  transports: ['websocket', 'polling'],
})
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);
  private connectedDrivers = new Map<string, string>(); // driverId -> socketId
  private connectedUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private trackingService: TrackingService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('🔌 WebSocket Tracking Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      // Authenticate via JWT
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.config.get<string>('jwt.secret'),
      });

      // Attach user to socket
      const account=await this.prisma.user.findUnique({where:{id:payload.sub},select:{role:true,status:true}});
      if(!account||['BANNED','SUSPENDED'].includes(account.status)){client.disconnect();return;}
      client.data.userId = payload.sub;
      client.data.role = account.role;

      // Join user room
      client.join(`user:${payload.sub}`);

      // If driver, register in driver map
      if (payload.role === 'DRIVER') {
        const driver = await this.prisma.driver.findUnique({
          where: { userId: payload.sub },
        });
        if (driver) {
          client.data.driverId = driver.id;
          this.connectedDrivers.set(driver.id, client.id);
          client.join(`driver:${driver.id}`);
          this.logger.log(`Driver ${driver.id} connected`);
        }
      } else {
        this.connectedUsers.set(payload.sub, client.id);
        this.logger.log(`User ${payload.sub} connected`);
      }
    } catch (error) {
      this.logger.warn(`Connection rejected: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.driverId) {
      this.connectedDrivers.delete(client.data.driverId);
      this.logger.log(`Driver ${client.data.driverId} disconnected`);
    } else if (client.data.userId) {
      this.connectedUsers.delete(client.data.userId);
    }
  }

  // ─── Driver: Update Location ──────────────────────────────────────────────
  @SubscribeMessage('driver:update_location')
  async handleDriverLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateLocationDto,
  ) {
    const driverId = client.data.driverId;
    if (!driverId) throw new WsException('Not a driver');

    await this.trackingService.updateDriverLocation(driverId, data);

    const dispatch=await this.prisma.dispatch.findFirst({where:{assignedDriverId:driverId,status:'ACCEPTED'},orderBy:{createdAt:'desc'}});
    if(dispatch)await this.emitAuthorized(dispatch.serviceType,dispatch.referenceId,'driver:location_updated',{driverId,...data,timestamp:new Date().toISOString()});

    return { ok: true };
  }

  // ─── Driver: Go Online ────────────────────────────────────────────────────
  @SubscribeMessage('driver:online')
  async handleDriverOnline(@ConnectedSocket() client: Socket) {
    const driverId = client.data.driverId;
    if (!driverId) throw new WsException('Not a driver');

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { availability: 'ONLINE' },
    });

    this.server.emit('driver:online', { driverId });
    return { ok: true, status: 'ONLINE' };
  }

  // ─── Driver: Go Offline ───────────────────────────────────────────────────
  @SubscribeMessage('driver:offline')
  async handleDriverOffline(@ConnectedSocket() client: Socket) {
    const driverId = client.data.driverId;
    if (!driverId) throw new WsException('Not a driver');

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { availability: 'OFFLINE' },
    });

    this.server.emit('driver:offline', { driverId });
    return { ok: true, status: 'OFFLINE' };
  }

  // ─── Customer: Track Order ────────────────────────────────────────────────
  @SubscribeMessage('track:join')
  async handleJoinTracking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomDto,
  ) {
    if(!data||typeof data.serviceType!=='string'||typeof data.referenceId!=='string')throw new WsException('Invalid tracking request');
    await this.trackingService.assertAccess(client.data.userId,client.data.role,data.serviceType,data.referenceId);
    const room = `tracking:${data.serviceType}:${data.referenceId}`;
    client.join(room);
    this.logger.debug(`User ${client.data.userId} joined tracking room ${room}`);
    return { ok: true, room };
  }

  @SubscribeMessage('track:leave')
  async handleLeaveTracking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomDto,
  ) {
    const room = `tracking:${data.serviceType}:${data.referenceId}`;
    client.leave(room);
    return { ok: true };
  }

  // ─── Driver: Accept/Reject Job (from dispatch) ────────────────────────────
  @SubscribeMessage('job:accept')
  async handleJobAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { dispatchId: string; attemptId: string },
  ) {
    const driverId = client.data.driverId;
    if (!driverId) throw new WsException('Not a driver');
    // Dispatch service handles logic
    return { event: 'job:accept', driverId, ...data };
  }

  @SubscribeMessage('job:reject')
  async handleJobReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { dispatchId: string; attemptId: string; reason?: string },
  ) {
    const driverId = client.data.driverId;
    if (!driverId) throw new WsException('Not a driver');
    return { event: 'job:reject', driverId, ...data };
  }

  // ─── Event Emitter Listeners (bridge domain events → WebSocket) ───────────

  @OnEvent('dispatch.accepted')
  async handleDispatchAccepted(payload: any) {
    await this.emitAuthorized(payload.serviceType,payload.referenceId,'delivery:assigned',payload);
  }

  @OnEvent('order:status_updated')
  async handleOrderStatusUpdated(payload: any) {
    await this.emitAuthorized(payload.serviceType,payload.referenceId,'order:updated',payload);
    // Also notify user directly
    this.server.to(`user:${payload.customerId}`).emit('order:updated', payload);
  }

  @OnEvent('driver.job_request')
  handleDriverJobRequest(payload: any) {
    // Send job request to specific driver
    this.server.to(`driver:${payload.driverId}`).emit('job:new', payload);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  isDriverOnline(driverId: string): boolean {
    return this.connectedDrivers.has(driverId);
  }

  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToDriver(driverId: string, event: string, data: any) {
    this.server.to(`driver:${driverId}`).emit(event, data);
  }

  private async emitAuthorized(serviceType:string,referenceId:string,event:string,data:any) {
    const room = `tracking:${serviceType}:${referenceId}`;
    for(const socket of await this.server.in(room).fetchSockets()){
      try{await this.trackingService.assertAccess(socket.data.userId,socket.data.role,serviceType,referenceId);socket.emit(event,data);}
      catch{socket.leave(room);}
    }
  }

  async emitToTrackingRoom(serviceType: string, referenceId: string, event: string, data: any) {
    await this.emitAuthorized(serviceType,referenceId,event,data);
  }
}
