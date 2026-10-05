const round2 = (n) => Math.round(n * 100) / 100;

// Standard amortised loan repayment: P * r / (1 - (1 + r)^-n), where r is the monthly rate.
export function calculateFinance({ price, deposit, termMonths, apr }) {
  const principal = Math.max(price - deposit, 0);
  const r = apr / 100 / 12;
  const monthly = principal === 0 ? 0 : r === 0 ? principal / termMonths : (principal * r) / (1 - (1 + r) ** -termMonths);
  const totalRepayable = monthly * termMonths;
  return {
    principal: round2(principal),
    monthlyPayment: round2(monthly),
    totalRepayable: round2(totalRepayable),
    totalInterest: round2(totalRepayable - principal),
  };
}
