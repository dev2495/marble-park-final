import { Module } from '@nestjs/common';
import { OwnerReportsResolver } from './owner-reports.resolver';
import { OwnerReportsService } from './owner-reports.service';

@Module({ providers: [OwnerReportsService, OwnerReportsResolver] })
export class OwnerReportsModule {}
