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
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { ReportingModule } from './modules/reporting/reporting.module';
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
        // The production API is browser-cookie authenticated. Keep schema
        // discovery and the interactive IDE unavailable on the public edge.
        graphiql: process.env.NODE_ENV !== 'production',
        introspection: process.env.NODE_ENV !== 'production',
        // Per-request DataLoaders prevent N+1 hits on hot relations
        // (Quote.customer, Quote.owner, Quote.lead, Lead.customer, Lead.owner).
        // Loaders are constructed fresh for each request so cached rows never
        // leak between users/sessions.
        context: ({ req, res }: any) => ({ req, res, requestId: req.requestId, loaders: buildLoaders(prisma) }),
        formatError: (formattedError: any, error: any) => {
          const original = error?.originalError;
          const response = typeof original?.getResponse === 'function'
            ? original.getResponse()
            : formattedError?.extensions?.originalError;
          if (!response || typeof response !== 'object') return formattedError;
          const diagnosticKeys = ['code', 'field', 'lineKey', 'remediation', 'maximumPreTaxNetRate'];
          const diagnostics = diagnosticKeys.reduce((result: any, key) => {
            if (response[key] !== undefined) result[key] = response[key];
            return result;
          }, {});
          return {
            ...formattedError,
            message: typeof response.message === 'string' ? response.message : formattedError.message,
            extensions: { ...(formattedError.extensions || {}), ...diagnostics },
          };
        },
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
    ReceivablesModule,
    ReportingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
