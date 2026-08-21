import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsResolver } from './imports.resolver';
import { TileDesignImportService } from './tile-design-import.service';

@Module({
  providers: [ImportsService, TileDesignImportService, ImportsResolver],
  exports: [ImportsService],
})
export class ImportsModule {}
