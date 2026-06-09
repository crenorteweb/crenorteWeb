import { UFS_NORTE, filtrarUfsNorte } from './pre-cadastro.service';

describe('UFS_NORTE', () => {
  it('inclui todos os estados da região Norte', () => {
    const norte = ['PA', 'AC', 'AP', 'AM', 'RO', 'RR', 'TO'];
    norte.forEach(uf => {
      expect(UFS_NORTE).toContain(uf as any);
    });
  });

  it('inclui Maranhão (MA)', () => {
    expect(UFS_NORTE).toContain('MA' as any);
  });

  it('inclui Mato Grosso (MT)', () => {
    expect(UFS_NORTE).toContain('MT' as any);
  });

  it('não inclui estados fora do escopo', () => {
    const fora = ['SP', 'RJ', 'MG', 'RS', 'BA'];
    fora.forEach(uf => {
      expect(UFS_NORTE).not.toContain(uf as any);
    });
  });

  it('contém exatamente 9 estados', () => {
    expect(UFS_NORTE.length).toBe(9);
  });
});

describe('filtrarUfsNorte', () => {
  const makeRow = (uf: string) => ({ id: '1', uf });

  it('mantém registros de estados permitidos', () => {
    const rows = ['PA', 'AM', 'MA', 'MT', 'TO'].map(makeRow);
    const resultado = filtrarUfsNorte(rows);
    expect(resultado.length).toBe(5);
  });

  it('remove registros de estados não permitidos', () => {
    const rows = ['SP', 'RJ', 'MG'].map(makeRow);
    expect(filtrarUfsNorte(rows).length).toBe(0);
  });

  it('aceita UF em minúsculas', () => {
    const rows = [{ id: '1', uf: 'ma' }, { id: '2', uf: 'mt' }];
    expect(filtrarUfsNorte(rows).length).toBe(2);
  });

  it('aceita UF com espaços', () => {
    const rows = [{ id: '1', uf: ' MA ' }];
    expect(filtrarUfsNorte(rows).length).toBe(1);
  });

  it('descarta registros sem campo uf', () => {
    const rows = [{ id: '1' }, { id: '2', uf: null }, { id: '3', uf: '' }];
    expect(filtrarUfsNorte(rows).length).toBe(0);
  });

  it('retorna array vazio quando entrada é vazia', () => {
    expect(filtrarUfsNorte([])).toEqual([]);
  });

  it('mantém MA e MT junto com estados do Norte na mesma lista', () => {
    const rows = ['PA', 'AM', 'MA', 'MT', 'SP', 'RJ'].map(makeRow);
    const resultado = filtrarUfsNorte(rows);
    const ufs = resultado.map((r: any) => r.uf);
    expect(ufs).toContain('PA');
    expect(ufs).toContain('AM');
    expect(ufs).toContain('MA');
    expect(ufs).toContain('MT');
    expect(ufs).not.toContain('SP');
    expect(ufs).not.toContain('RJ');
  });
});
