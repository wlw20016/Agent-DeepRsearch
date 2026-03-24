type str="beyond"

type startWith<str extends string,T extends string>=str extends `${T}${infer rest}`?true:false

type UppercaseFirst<str extends string>=str extends `${infer F}${infer R}`?`${Uppercase<F>}${R}`:never
type res=UppercaseFirst<str>

type ReplaceOne<str extends string,from extends string ,to extends string>=str extends `${infer Front}${from}${infer Rest}`?`${Front}${to}${Rest}`:str
type res2=ReplaceOne<str,"b","p">//peyond