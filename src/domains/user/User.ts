import { UserId } from "./UserId.ts";
import { Email } from "./Email.ts";

export class User {
  readonly id: UserId;
  readonly email: Email;
  readonly name: string;

  private constructor(id: UserId, email: Email, name: string) {
    this.id = id;
    this.email = email;
    this.name = name;
  }

  static create(email: Email, name: string): User {
    const id = UserId.create(crypto.randomUUID());
    return new User(id, email, name);
  }
}
