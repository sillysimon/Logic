import { Tuple, RecursiveMap as Map, RecursiveSet as Set, Value } from 'recursive-set';

// --- Auxiliary Functions ---

function set<T extends Value>(...elements: T[]): Set<T> {
    return new Set(...elements);
}

function tpl<T extends Value[]>(...elements: T): Tuple<T> {
    return new Tuple(...elements);
}

// --- Exported Types ---

/**
 * A `CSP` (Constraint Satisfaction Problem) is defined as a tuple of the form
 * [Vars, Values, Constraints]
 * where:
 * - Vars is a list of variables.
 * - Values is a list of numbers that these variables can take.
 * - Constraints is a list of formulas describing conditions that the variables must satisfy.
 * Formulas are given as strings and must be valid TypeScript expressions evaluating to a Boolean.
 */
export type Variable = string;
export type Formula  = string;
export type CSP = [Variable[], number[], Formula[]];

/**
 * An `Assignment` maps some variables to values.
 */
export type Assignment = Map<Variable, number>;

/**
 * An `AnnotatedConstraint` is a pair consisting of a formula and the set of all 
 * variables occurring in this formula.
 */
type AnnotatedConstraint = [Formula, Set<Variable>];

// --- Internal Helper Functions ---

/**
 * Takes a string `expr` that can be interpreted as a valid expression and collects 
 * all variables occurring in it. It removes names that correspond to predefined 
 * values or functions (like Math, true, false).
 */
function collectVariables(expr: Formula): Set<Variable> {
    const identifierRegex = /(?<!\.)\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const variables: Variable[] = [];
    const coreGlobals = new globalThis.Set(['Math', 'true', 'false']);
    let match: RegExpExecArray | null;
    
    while ((match = identifierRegex.exec(expr)) != null) {
        const candidate = match[0];
        if (!coreGlobals.has(candidate)) {
            variables.push(candidate);
        }
    }
    return set(...variables);
}

/**
 * Takes a string expression and a variable assignment (context), creates a 
 * dynamic function, and evaluates the given expression using the provided values.
 */
function evaluateExpression(
    expr:   Formula, 
    assign: Assignment, 
    vars:   Set<Variable>
): boolean {
    const argNames:  Variable[] = [];
    const argValues: number  [] = [];
    
    for (const v of vars) {
        argNames.push(v);
        // Provide the mapped value if it exists
        const val = assign.get(v);
        if (val !== undefined) argValues.push(val);
    }
    
    try {
        const func = new Function(...argNames, `return (${expr});`);
        const result: unknown = func(...argValues);
        return typeof result === 'boolean' ? result : false;
    } catch (e) {
        return false;
    }
}

/**
 * Checks whether the partial assignment + {variable -> value} violates any of the 
 * formulas in `constraints`. Assumes the current Assignment is already consistent.
 */
function isConsistent(
    variable:     Variable,
    value:        number,
    assignment:   Assignment,
    assignedVars: Set<Variable>,
    constraints: AnnotatedConstraint[]
): boolean {
    const newAssignment = assignment.mutableCopy();
    newAssignment.set(variable, value);
    
    const newAssignedVars = assignedVars.clone();
    newAssignedVars.add(variable);
    
    return constraints.every(([formula, vars]) => {
        const canEvaluate = vars.has(variable) && vars.isSubset(newAssignedVars);
        return !canEvaluate || evaluateExpression(formula, newAssignment, vars);
    });
}

/**
 * Given a consistent partial variable assignment, tries to extend the assignment 
 * recursively to produce a solution of the given CSP.
 */
function backtrackSearch(
    assignment:   Assignment,
    assignedVars: Set<Variable>,
    variables:    Variable[],
    values: number[],
    constraints: AnnotatedConstraint[]
): Assignment | null {   
    
    if (assignedVars.size === variables.length) { 
        return assignment; 
    }
    
    const nextVar = variables.find(v => !assignedVars.has(v));    
    
    // Strict null check to ensure TypeScript knows nextVar is definitely a string
    if (nextVar === undefined) {
        return null;
    }
    
    for (const value of values) {
        if (isConsistent(nextVar, value, assignment, assignedVars, constraints)) {       
            const newAssignment = assignment.mutableCopy();
            newAssignment.set(nextVar, value);    
            
            const newAssignedVars = assignedVars.clone();
            newAssignedVars.add(nextVar);
            
            const result = backtrackSearch(
                newAssignment, 
                newAssignedVars, 
                variables, 
                values, 
                constraints
            );
            
            if (result != null) { 
                return result; 
            }
        }
    }
    return null;
}

// --- Main Exported API ---

/**
 * Tries to compute a solution for the given Constraint Satisfaction Problem via backtracking.
 * It transforms the CSP formulas into AnnotatedConstraints, then begins the recursive search.
 * * @param csp The Constraint Satisfaction Problem tuple
 * @returns A RecursiveMap containing the assigned values, or null if no solution exists.
 */
export function solve(csp: CSP): Assignment | null {
    const [Vars, Values, Constrs] = csp;
    
    // Transform string constraints into AnnotatedConstraints [formula, Set<variables>]
    const annotatedConstraints: AnnotatedConstraint[] = Constrs.map(f => [f, collectVariables(f)]);
    
    const initialAssignment = new Map<string, number>();
    const initialAssignedVars = set<string>(); // Empty RecursiveSet
    
    return backtrackSearch(
        initialAssignment, 
        initialAssignedVars, 
        Vars, 
        Values, 
        annotatedConstraints
    );
}
