import { Global, Module } from '@nestjs/common';
import { StoredImageService } from './stored-image.service';

@Global()
@Module({
  providers: [StoredImageService],
  exports: [StoredImageService],
})
export class AssetsModule {}
