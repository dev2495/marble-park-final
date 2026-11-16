import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ProductsModule } from '../products/products.module';
import { SystemModule } from '../system/system.module';
import { FollowUpsService } from './follow-ups.service';
import { FollowUpsResolver } from './follow-ups.resolver';

@Module({
  imports: [CustomersModule, ProductsModule, SystemModule],
  providers: [FollowUpsService, FollowUpsResolver],
})
export class FollowUpsModule {}
