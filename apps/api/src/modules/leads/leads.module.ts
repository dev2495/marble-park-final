import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsResolver } from './leads.resolver';
import { QuotesModule } from '../quotes/quotes.module';

@Module({
  imports: [QuotesModule],
  providers: [LeadsService, LeadsResolver],
  exports: [LeadsService],
})
export class LeadsModule {}
