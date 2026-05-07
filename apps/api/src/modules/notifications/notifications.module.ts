import { Global, Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [NotificationsService, NotificationsResolver],
  exports: [NotificationsService],
})
export class NotificationsModule {}
