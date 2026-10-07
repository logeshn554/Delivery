import { Injectable } from '@nestjs/common';

@Injectable()
export class DistanceService {
  /**
   * Haversine formula — great-circle distance between two points
   * Returns distance in kilometers
   */
  haversine(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Estimate travel time in minutes
   * Assumes average city speed of 25 km/h with traffic factor
   */
  estimateMinutes(distanceKm: number, avgSpeedKmh = 25): number {
    const rawMinutes = (distanceKm / avgSpeedKmh) * 60;
    // Add buffer: 2 min for short distances, proportional for longer
    const buffer = Math.min(distanceKm * 0.5, 5);
    return Math.ceil(rawMinutes + buffer);
  }

  /**
   * Check if a point is within a bounding box
   */
  isWithinBoundingBox(
    lat: number,
    lng: number,
    centerLat: number,
    centerLng: number,
    radiusKm: number,
  ): boolean {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));
    return (
      lat >= centerLat - latDelta &&
      lat <= centerLat + latDelta &&
      lng >= centerLng - lngDelta &&
      lng <= centerLng + lngDelta
    );
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
