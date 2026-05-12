import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { buildLoaders } from './modules/common/dataloaders';
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
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';

import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        autoSchemaFile: true,
        playground: true,
        // Per-request DataLoaders prevent N+1 hits on hot relations
        // (Quote.customer, Quote.owner, Quote.lead, Lead.customer, Lead.owner).
        // Loaders are constructed fresh for each request so cached rows never
        // leak between users/sessions.
        context: ({ req }: any) => ({ req, loaders: buildLoaders(prisma) }),
      }),
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
    NotificationsModule,
    AuditModule,
  ],
})
export class AppModule {}
