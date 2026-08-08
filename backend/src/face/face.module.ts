import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import multer from 'multer';
import { DevicesModule } from '../devices/devices.module';
import { FaceController, IdentifyAliasController } from './face.controller';
import { FaceService } from './face.service';

@Module({
  imports: [DevicesModule],
  providers: [FaceService],
  controllers: [FaceController, IdentifyAliasController],
  exports: [FaceService],
})
export class FaceModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('photo'))
      .forRoutes(
        { path: 'face/identify', method: RequestMethod.POST },
        { path: 'identify', method: RequestMethod.POST },
      );
  }
}
