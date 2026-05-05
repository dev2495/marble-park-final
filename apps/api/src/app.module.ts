import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { LeadsModule } from './modules/leads/leads.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ProductsModule } from './modules/products/products.module';
import { SystemModule } from './modules/system/system.module';

import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: true,
      context: ({ req }) => ({ req }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CustomersModule,
    LeadsModule,
    QuotesModule,
    InventoryModule,
    DispatchModule,
    DashboardsModule,
    DocumentsModule,
    ImportsModule,
    SearchModule,
    SystemModule,
  ],
})
export class AppModule {}
