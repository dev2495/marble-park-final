import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: string;
  phone: string;
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  role?: string;
  active?: boolean;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserInput): Promise<any> {
    const passwordHash = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: {
        id: ulid(),
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        phone: data.phone,
      },
    } as any) as any;
  }

  async update(id: string, data: UpdateUserInput) {
    await this.findById(id);
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.user.delete({ where: { id } });
  }

  async verifyPassword(user: { passwordHash: string }, password: string) {
    return bcrypt.compare(password, user.passwordHash);
  }
}