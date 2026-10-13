import { Module } from '@nestjs/common';
import { JorfModule } from 'src/jorf/jorf.module.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [JorfModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
