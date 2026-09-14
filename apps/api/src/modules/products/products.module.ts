import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsResolver } from './products.resolver';
import { ProductMrpBulkService } from './product-mrp-bulk.service';

@Module({
  providers: [ProductsService, ProductMrpBulkService, ProductsResolver],
  exports: [ProductsService],
})
export class ProductsModule {}
