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
import { ProcurementModule } from './modules/procurement/procurement.module';
import { OperationsModule } from './modules/operations/operations.module';
import { AuditModule } from './modules/audit/audit.module';
import { IntentsModule } from './modules/intents/intents.module';
import { HealthController } from './health.controller';

import { SearchModule } from './modules/search/search.module';
import { AssetsModule } from './modules/assets/assets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        autoSchemaFile: true,
        graphiql: process.env.NODE_ENV !== 'production' || process.env.GRAPHQL_PLAYGROUND === 'true',
        // Per-request DataLoaders prevent N+1 hits on hot relations
        // (Quote.customer, Quote.owner, Quote.lead, Lead.customer, Lead.owner).
        // Loaders are constructed fresh for each request so cached rows never
        // leak between users/sessions.
        context: ({ req, res }: any) => ({ req, res, requestId: req.requestId, loaders: buildLoaders(prisma) }),
        plugins: [{
          async requestDidStart() {
            return {
              async didEncounterErrors({ errors, contextValue }: any) {
                const requestId = contextValue?.requestId;
                if (!requestId) return;
                for (const error of errors || []) {
                  error.extensions = { ...(error.extensions || {}), requestId };
                }
              },
            };
          },
        }],
      }),
    }),
    PrismaModule,
    AssetsModule,
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
    ProcurementModule,
    OperationsModule,
    NotificationsModule,
    AuditModule,
    IntentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
