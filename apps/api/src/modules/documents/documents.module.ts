import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsResolver } from './documents.resolver';
import { DocumentsController, DocumentsHttpProviders } from './documents.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsResolver, ...DocumentsHttpProviders],
  exports: [DocumentsService],
})
export class DocumentsModule {}
