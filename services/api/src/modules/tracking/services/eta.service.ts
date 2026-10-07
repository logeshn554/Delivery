import { Injectable } from '@nestjs/common';

@Injectable()
export class EtaService {
  /**
   * Calculate estimated time of arrival given coordinates and average city speed (30 km/h)
   */
  calculateEta(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    avgSpeedKmh: number = 30,
  ): { distanceKm: number; etaMinutes: number } {
    const R = 6371; // Earth radius in km
    const dLat = ((toLat - fromLat) * Math.PI) / 180;
    const dLng = ((toLng - fromLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((fromLat * Math.PI) / 180) *
        Math.cos((toLat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = Math.round(R * c * 10) / 10;
    const etaMinutes = Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));

    return { distanceKm, etaMinutes };
  }
}
