import { Module } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { DashboardsResolver } from './dashboards.resolver';

@Module({
  providers: [DashboardsService, DashboardsResolver],
})
export class DashboardsModule {}