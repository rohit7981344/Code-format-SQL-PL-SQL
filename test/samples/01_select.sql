select e.empno, e.ename, d.dname, sum(e.sal) total_sal, count(*) cnt from emp e join dept d on e.deptno = d.deptno left outer join bonus b on b.ename = e.ename where e.sal between 1000 and 5000 and d.loc = 'DALLAS' or e.job in ('CLERK','MANAGER') group by e.empno, e.ename, d.dname having sum(e.sal) > 100 order by total_sal desc, e.ename;
select * from (select ename, sal, row_number() over (partition by deptno order by sal desc) rn from emp) where rn <= 3;
insert into emp (empno, ename, sal) values (1, 'SMITH', 800);
update emp set sal = sal * 1.1, comm = nvl(comm,0) + 100 where deptno = 10 and job = 'CLERK';
delete from emp where empno = 7369;
with dept_tot as (select deptno, sum(sal) tot from emp group by deptno) select d.dname, t.tot, case when t.tot > 10000 then 'HIGH' when t.tot > 5000 then 'MEDIUM' else 'LOW' end as band from dept d join dept_tot t on t.deptno = d.deptno;
