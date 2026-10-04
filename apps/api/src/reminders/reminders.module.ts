import { Module } from '@nestjs/common';
import { JorfModule } from 'src/jorf/jorf.module';
import { RemindersService } from './reminders.service';

@Module({
  imports: [JorfModule],
  providers: [RemindersService],
})
export class RemindersModule {}
