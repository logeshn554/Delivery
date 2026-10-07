import { Injectable } from '@nestjs/common';
import { DriverCandidate } from '../matching/driver-matching.service';

@Injectable()
export class LowestEtaStrategy {
  selectBestDriver(candidates: DriverCandidate[]): DriverCandidate | null {
    if (!candidates || candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes)[0];
  }
}
