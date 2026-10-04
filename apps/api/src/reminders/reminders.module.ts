import { Module } from '@nestjs/common';
import { JorfModule } from 'src/jorf/jorf.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [JorfModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
