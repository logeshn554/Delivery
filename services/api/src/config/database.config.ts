import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  shadowUrl: process.env.DATABASE_SHADOW_URL,
}));
