import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersResolver } from './customers.resolver';

@Module({
  providers: [CustomersService, CustomersResolver],
  exports: [CustomersService],
})
export class CustomersModule {}