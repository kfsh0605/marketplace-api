import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

    @Get()
    @ApiOperation({ operationId: 'getHealth', summary: 'Перевірка стану застосунку та підключення до БД' })
    @ApiServiceUnavailableResponse({ description: 'Базу даних недоступна' })
    async check() {
        try {
            await this.pool.query('SELECT 1');
            return { status: 'ok', database: 'up', uptime: process.uptime() };
        } catch (error) {
            throw new ServiceUnavailableException('Database is not reachable');
        }
    }
}