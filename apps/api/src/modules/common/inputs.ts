import { InputType, Field, ID } from '@nestjs/graphql';

@InputType()
export class LoginInput {
  @Field()
  email: string;

  @Field()
  password: string;
}

@InputType()
export class CreateUserInput {
  @Field()
  name: string;

  @Field()
  email: string;

  @Field()
  password: string;

  @Field()
  role: string;

  @Field()
  phone: string;
}

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  role?: string;

  @Field({ nullable: true })
  active?: boolean;
}

@InputType()
export class CreateCustomerInput {
  @Field()
  name: string;

  @Field({ nullable: true })
  companyName?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  gstNo?: string;

  @Field({ nullable: true })
  address?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  state?: string;

  @Field({ nullable: true })
  architect?: string;

  @Field({ nullable: true })
  designer?: string;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class UpdateCustomerInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  companyName?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  gstNo?: string;

  @Field({ nullable: true })
  address?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  state?: string;

  @Field({ nullable: true })
  architect?: string;

  @Field({ nullable: true })
  designer?: string;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateLeadInput {
  @Field(() => ID)
  customerId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  source?: string;

  @Field(() => ID)
  ownerId: string;

  @Field({ nullable: true })
  stage?: string;

  @Field({ nullable: true })
  expectedValue?: number;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  nextActionAt?: Date;
}

@InputType()
export class UpdateLeadInput {
  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  source?: string;

  @Field(() => ID, { nullable: true })
  ownerId?: string;

  @Field({ nullable: true })
  stage?: string;

  @Field({ nullable: true })
  expectedValue?: number;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  nextActionAt?: Date;
}

@InputType()
export class CreateQuoteInput {
  @Field(() => ID)
  leadId: string;

  @Field(() => ID)
  customerId: string;

  @Field(() => ID)
  ownerId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  projectName?: string;

  @Field({ nullable: true })
  validUntil?: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  lines?: any;
}

@InputType()
export class UpdateQuoteInput {
  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  projectName?: string;

  @Field({ nullable: true })
  validUntil?: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  lines?: any;

  @Field({ nullable: true })
  discountPercent?: number;
}

@InputType()
export class CreateDispatchJobInput {
  @Field(() => ID, { nullable: true })
  quoteId?: string;

  @Field(() => ID)
  customerId: string;

  @Field({ nullable: true })
  scheduledAt?: Date;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateChallanInput {
  @Field(() => ID)
  jobId: string;

  @Field({ nullable: true })
  transporter?: string;

  @Field({ nullable: true })
  vehicleNo?: string;

  @Field({ nullable: true })
  driverName?: string;

  @Field({ nullable: true })
  driverPhone?: string;

  @Field({ nullable: true })
  packages?: number;
}

@InputType()
export class SendEmailInput {
  @Field()
  to: string;

  @Field()
  subject: string;

  @Field()
  body: string;

  @Field(() => ID, { nullable: true })
  quoteId?: string;

  @Field({ nullable: true })
  attachments?: any;
}