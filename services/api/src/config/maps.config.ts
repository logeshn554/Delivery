import { registerAs } from '@nestjs/config';

export default registerAs('maps', () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
}));
