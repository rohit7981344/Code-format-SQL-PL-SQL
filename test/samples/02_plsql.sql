create or replace procedure raise_salary(p_empno in emp.empno%type, p_pct in number default 10, p_new_sal out number) is
  v_sal emp.sal%type;
  e_too_high exception;
  cursor c_emp(p_dept number) is select empno, sal from emp where deptno = p_dept;
begin
  select sal into v_sal from emp where empno = p_empno;
  if v_sal > 5000 then raise e_too_high; elsif v_sal < 1000 then v_sal := v_sal * 2; else v_sal := v_sal + (v_sal * p_pct / 100); end if;
  for r in c_emp(10) loop dbms_output.put_line('Emp ' || r.empno || ' sal ' || r.sal); end loop;
  for i in 1..10 loop
    exit when i > 5;
    continue when mod(i,2) = 0;
    dbms_output.put_line(i);
  end loop;
  update emp set sal = v_sal where empno = p_empno returning sal into p_new_sal;
  commit;
exception
  when e_too_high then raise_application_error(-20001, 'Salary too high');
  when no_data_found then dbms_output.put_line('Not found'); rollback;
  when others then rollback; raise;
end raise_salary;
/
declare v_count number := 0; begin select count(*) into v_count from emp; case when v_count > 10 then dbms_output.put_line('big'); else dbms_output.put_line('small'); end case; end;
/
