/** A household member with their own account. */
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface NewUser {
  name: string;
  email: string;
}
