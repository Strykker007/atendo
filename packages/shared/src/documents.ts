/**
 * CPF/CNPJ: só dígitos e dígitos verificadores. O Asaas recusa a cobrança sem um documento
 * válido — conferir antes poupa uma ida ao gateway e dá a mensagem certa na tela.
 */
export function cpfCnpjDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos; aceita com ou sem máscara. */
export function isValidCpfCnpj(raw: string | null | undefined): boolean {
  const d = cpfCnpjDigits(raw);
  return d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false;
}
