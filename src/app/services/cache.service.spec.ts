import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CacheService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  describe('set / get', () => {
    it('retorna null para chave inexistente', () => {
      expect(service.get('nao_existe')).toBeNull();
    });

    it('retorna o valor armazenado dentro do TTL', () => {
      service.set('chave', { nome: 'teste' });
      expect(service.get<{ nome: string }>('chave')).toEqual({ nome: 'teste' });
    });

    it('retorna null após o TTL expirar', fakeAsync(() => {
      service.set('chave', 'valor', 1000); // TTL = 1s
      tick(1001);
      expect(service.get('chave')).toBeNull();
    }));

    it('não expira antes do TTL', fakeAsync(() => {
      service.set('chave', 'valor', 1000);
      tick(999);
      expect(service.get('chave')).toBe('valor');
    }));

    it('aceita tipos diferentes de valor', () => {
      service.set('lista', [1, 2, 3]);
      service.set('numero', 42);
      service.set('booleano', true);

      expect(service.get<number[]>('lista')).toEqual([1, 2, 3]);
      expect(service.get<number>('numero')).toBe(42);
      expect(service.get<boolean>('booleano')).toBe(true);
    });

    it('sobrescreve entrada existente com novo set', () => {
      service.set('chave', 'primeiro');
      service.set('chave', 'segundo');
      expect(service.get('chave')).toBe('segundo');
    });
  });

  describe('invalidate', () => {
    it('remove a entrada especificada', () => {
      service.set('chave', 'valor');
      service.invalidate('chave');
      expect(service.get('chave')).toBeNull();
    });

    it('não afeta outras entradas', () => {
      service.set('a', 1);
      service.set('b', 2);
      service.invalidate('a');
      expect(service.get('b')).toBe(2);
    });

    it('não lança erro ao invalidar chave inexistente', () => {
      expect(() => service.invalidate('nao_existe')).not.toThrow();
    });
  });

  describe('invalidatePattern', () => {
    beforeEach(() => {
      service.set('pre_caixa_uid1', ['a']);
      service.set('pre_caixa_uid2', ['b']);
      service.set('colaboradores_lista', ['c']);
    });

    it('remove todas as entradas que começam com o prefixo', () => {
      service.invalidatePattern('pre_caixa_');
      expect(service.get('pre_caixa_uid1')).toBeNull();
      expect(service.get('pre_caixa_uid2')).toBeNull();
    });

    it('preserva entradas com prefixo diferente', () => {
      service.invalidatePattern('pre_caixa_');
      expect(service.get('colaboradores_lista')).toEqual(['c']);
    });

    it('não lança erro quando nenhuma chave bate com o prefixo', () => {
      expect(() => service.invalidatePattern('prefixo_inexistente_')).not.toThrow();
    });

    it('prefixo vazio remove todas as entradas', () => {
      service.invalidatePattern('');
      expect(service.get('pre_caixa_uid1')).toBeNull();
      expect(service.get('colaboradores_lista')).toBeNull();
    });
  });
});
