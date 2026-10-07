import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presign')
  async getPresignedUrl(
    @Body('filename') filename: string,
    @Body('contentType') contentType: string,
  ) {
    return this.uploadsService.getPresignedUploadUrl(filename, contentType);
  }
}
