import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesResolver } from './quotes.resolver';
import { ReceivablesModule } from '../receivables/receivables.module';

@Module({
  imports: [ReceivablesModule],
  providers: [QuotesService, QuotesResolver],
  exports: [QuotesService],
})
export class QuotesModule {}
