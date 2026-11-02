import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsResolver } from './products.resolver';
import { ProductMrpBulkService } from './product-mrp-bulk.service';
import { PublicCatalogueService } from './public-catalogue.service';
import { PublicCatalogueResolver } from './public-catalogue.resolver';

@Module({
  providers: [ProductsService, ProductMrpBulkService, ProductsResolver, PublicCatalogueService, PublicCatalogueResolver],
  exports: [ProductsService],
})
export class ProductsModule {}
