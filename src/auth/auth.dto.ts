import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
    @ApiProperty({ example: 'olena.kravchenko@example.com' })
    @IsEmail()
    @MaxLength(254)
    email: string;

    @ApiProperty({ example: 'marketplace-dev-password' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    password: string;
}

export class RefreshDto {
    @ApiProperty({ description: 'Непрозорий refresh-токен, виданий при логіні або попередньому refresh' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    refreshToken: string;
}

export class TokenPairDto {
    @ApiProperty({ description: 'Короткоживучий JWT (ES256)' })
    accessToken: string;

    @ApiProperty({ description: 'Одноразовий refresh-токен; при кожному refresh видається новий' })
    refreshToken: string;

    @ApiProperty({ example: 'Bearer' })
    tokenType: 'Bearer';

    @ApiProperty({ example: 600, description: 'Час життя access-токена в секундах' })
    expiresIn: number;
}