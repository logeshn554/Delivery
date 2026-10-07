import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {server} from '../../server.mjs';

// Reuse the authorized delivery engine while replacing its storage module.
// Body parsing stays in the engine to preserve its byte limit and stream support.
class ApplicationModule {}
Module({})(ApplicationModule);
const app = await NestFactory.create(ApplicationModule, {bodyParser:false});
app.enableShutdownHooks();
app.use((request, response) => server.emit('request', request, response));
await app.listen(Number(process.env.API_PORT || 3001), process.env.API_HOST || '127.0.0.1');
