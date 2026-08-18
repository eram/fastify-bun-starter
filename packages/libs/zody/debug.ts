import { z } from './zody';

@z.Schema({ inferDefault: true })
class User {
  @z.int.min(1) id!: number;
  @z.min(3) name = 'john';
  @z.email.optional email?: string;
  @z.bigint visits!: bigint;
}

console.log('Testing User class...');
console.log('Valid:', User.validate({ id: 1, name: 'john', visits: 4n }));
console.log('Invalid (id=0):', User.validate({ id: 0, name: 'john', visits: 4n }));
console.log('Invalid (name too short):', User.validate({ id: 1, name: 'jo', visits: 4n }));
