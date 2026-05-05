import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { DispatchResolver } from './dispatch.resolver';

@Module({
  providers: [DispatchService, DispatchResolver],
  exports: [DispatchService],
})
export class DispatchModule {}