import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportingResolver } from './reporting.resolver';
import { ReportingService } from './reporting.service';

@Module({
  imports: [PrismaModule],
  providers: [ReportingResolver, ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
