import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsResolver } from './operations.resolver';
import { OperationsService } from './operations.service';

@Module({
  imports: [PrismaModule],
  providers: [OperationsResolver, OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
