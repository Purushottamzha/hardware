import { Global, Module } from '@nestjs/common';
import { SecretCipherService } from './crypto/secret-cipher.service';

@Global()
@Module({
  providers: [SecretCipherService],
  exports: [SecretCipherService],
})
export class CommonModule {}
