import { Injectable } from '@nestjs/common';
import { DriverCandidate } from '../matching/driver-matching.service';

@Injectable()
export class NearestDriverStrategy {
  selectBestDriver(candidates: DriverCandidate[]): DriverCandidate | null {
    if (!candidates || candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  }
}
