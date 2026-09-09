import { Global, Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';

@Global()
@Module({
  providers: [NotificationsService, NotificationsResolver, NotificationsWorker],
  exports: [NotificationsService],
})
export class NotificationsModule {}
