// FOLParser.ts

// ----------------------------------------------------------------------------
// Type Definitions
// ----------------------------------------------------------------------------

export type ConstantOp = '⊤' | '⊥';
export type UnaryOp = '¬';
export type QuantifierOp = '∀' | '∃';
export type BinaryOp = '↔' | '→' | '∨' | '∧' | '=' | '<' | '>' | '≤' | '≥' | '+' | '-' | '*' | '/' | '%' | '**';

export type Variable        = string;
export type FunctionSymbol  = string;
export type PredicateSymbol = string;
export type Constant        = [ConstantOp];
export type Unary           = [UnaryOp, AST];
export type Quantifier      = [QuantifierOp, Variable, AST];
export type Binary          = [BinaryOp, AST, AST];
export type FctnOrPrd       = [FunctionSymbol | PredicateSymbol, ...AST[]];

export type AST =
    | Variable
    | Constant
    | Unary
    | Quantifier
    | Binary
    | FctnOrPrd;

// ----------------------------------------------------------------------------
// Internal Helpers (Not exported)
// ----------------------------------------------------------------------------

function popOrThrow<T>(stack: T[], errorMsg: string): T {
    const val = stack.pop();
    if (val === undefined) {
        throw new Error(errorMsg);
    }
    return val;
}

function tokenize(s: string): string[] {
    const lexSpec = /\s*(?:(\*\*)|([A-Z][a-zA-Z0-9_]*)|([a-z][a-zA-Z0-9_]*)|(\d+(?:\.\d+)?)|([⊤⊥∧∨¬→↔()∀∃:,<>=≤≥+\-*/%]))\s*/g;
    return Array.from(s.matchAll(lexSpec))
        .map(m => m[1] || m[2] || m[3] || m[4] || m[5])
        .filter((t): t is string => !!t);
}

const isVar    = (s: string) => /^[A-Z][a-zA-Z0-9_]*$/.test(s);
const isSym    = (s: string) => /^[a-z][a-zA-Z0-9_]*$/.test(s);
const isNum    = (s: string) => /^\d+(\.\d+)?$/.test(s);
const isPrefix = (op: string) => op === '¬' || op.startsWith('∀|') || op.startsWith('∃|');

function getPrec(op: string): number {
    if (isPrefix(op)) return 4.5; 
    
    const precedences: Record<string, number> = {
        '↔': 1,
        '→': 2,
        '∨': 3,
        '∧': 4,
        '=': 5, '<': 5, '>': 5, '≤': 5, '≥': 5,
        '+': 6, '-': 6,
        '*': 7, '/': 7, '%': 7,
        '**': 8
    };
    return precedences[op] || 0;
}

const MARKER = "((MARKER))";

// ----------------------------------------------------------------------------
// Main Parser Class
// ----------------------------------------------------------------------------

export class LogicParser {
    private _tokens:    string[];
    private _operators: string[];
    private _arguments: AST[];
    private _input:     string;

    constructor(s: string) {
        this._tokens = tokenize(s).reverse();
        this._operators = [];
        this._arguments = [];
        this._input = s;
    }

    parse(): AST {
        while (this._tokens.length !== 0) {
            const next_op = popOrThrow(this._tokens, "Unexpected end of input");

            // 1. Variables and Numbers
            if (isVar(next_op) || isNum(next_op)) {
                this._arguments.push(next_op);
                continue;
            }

            // 2. Constants
            if (next_op === '⊤' || next_op === '⊥') {
                this._arguments.push([next_op as ConstantOp]);
                continue;
            }

            // 3. Functions & Predicates
            if (isSym(next_op)) {
                const peek = this._tokens[this._tokens.length - 1];
                if (peek === '(') {
                    this._operators.push(next_op);
                } else {
                    this._arguments.push([next_op]); // 0-ary symbol
                }
                continue;
            }

            // 4. Quantifiers
            if (next_op === '∀' || next_op === '∃') {
                const q = next_op;
                const v = popOrThrow(this._tokens, `Expected variable after ${q}`);
                if (!isVar(v)) throw new Error(`Expected uppercase variable, got ${v}`);
                const colon = popOrThrow(this._tokens, `Expected ':' after ${v}`);
                if (colon !== ':') throw new Error(`Expected ':', got ${colon}`);
                this._operators.push(`${q}|${v}`);
                continue;
            }

            // 5. Open Parenthesis
            if (this._operators.length === 0 || next_op === '(') {
                this._operators.push(next_op);
                if (next_op === '(') {
                    this._arguments.push(MARKER);
                }
                continue;
            }

            // 6. Close Parenthesis
            if (next_op === ')') {
                while (this._operators.length > 0 && this._operators[this._operators.length - 1] !== '(') {
                    this._pop_and_evaluate();
                }
                if (this._operators.length === 0) throw new Error("Mismatched parentheses");
                popOrThrow(this._operators, ""); // Pop '('

                if (this._operators.length > 0 && isSym(this._operators[this._operators.length - 1])) {
                    // Form the function/predicate AST node
                    const funcSym = this._operators.pop()!;
                    const args: AST[] = [];
                    while (true) {
                        if (this._arguments.length === 0) throw new Error("Missing MARKER");
                        const arg = this._arguments.pop()!;
                        if (arg === MARKER) break;
                        args.push(arg);
                    }
                    args.reverse();
                    this._arguments.push([funcSym, ...args]);
                } else {
                    // Resolve grouping parentheses
                    const result = popOrThrow(this._arguments, "Empty parentheses");
                    if (result === MARKER) throw new Error("Empty parentheses are not allowed");
                    const marker = popOrThrow(this._arguments, "Missing MARKER");
                    if (marker !== MARKER) throw new Error("Expected MARKER");
                    this._arguments.push(result);
                }
                continue;
            }

            // 7. Commas (Arguments separator)
            if (next_op === ',') {
                while (this._operators.length > 0 && this._operators[this._operators.length - 1] !== '(') {
                    this._pop_and_evaluate();
                }
                continue;
            }

            // 8. Standard Operators
            const stack_op = this._operators[this._operators.length - 1];
            if (this._eval_before(stack_op, next_op)) {
                this._pop_and_evaluate();
                this._tokens.push(next_op); 
            } else {
                this._operators.push(next_op);
            }
        }

        while (this._operators.length !== 0) {
            this._pop_and_evaluate();
        }

        if (this._arguments.length !== 1) {
            throw new Error(`Could not parse ${this._input}`);
        }
        return popOrThrow(this._arguments, "Unexpected end of input");
    }

    private _eval_before(stack_op: string, next_op: string): boolean {
        if (stack_op === '(') return false;
        const prec_stack = getPrec(stack_op);
        const prec_next  = getPrec(next_op);

        if (prec_stack > prec_next) return true;
        if (prec_stack === prec_next) {
            if (next_op === '**' || next_op === '→') return false;
            if (stack_op === '↔' && next_op === '↔') throw new Error("↔ is not associative");
            if (isPrefix(stack_op) && isPrefix(next_op)) return false;
            return true;
        }
        return false;
    }

    private _pop_and_evaluate(): void {
        const op = popOrThrow(this._operators, "Unexpected end of input");
        
        if (op === '¬') {
            const arg = popOrThrow(this._arguments, "Missing argument for ¬");
            this._arguments.push(['¬', arg]);
            return;
        }
        
        if (op.startsWith('∀|') || op.startsWith('∃|')) {
            const arg = popOrThrow(this._arguments, `Missing argument for ${op}`);
            this._arguments.push([op[0] as QuantifierOp, op.slice(2), arg]);
            return;
        }
        
        const binaryOps = ['↔', '→', '∨', '∧', '=', '<', '>', '≤', '≥', '+', '-', '*', '/', '%', '**'];
        if (binaryOps.includes(op)) {
            const rhs = popOrThrow(this._arguments, `Missing right argument for ${op}`);
            const lhs = popOrThrow(this._arguments, `Missing left argument for ${op}`);
            this._arguments.push([op as BinaryOp, lhs, rhs]);
            return;
        }
        
        throw new Error(`Unknown operator to evaluate: ${op}`);
    }
}
