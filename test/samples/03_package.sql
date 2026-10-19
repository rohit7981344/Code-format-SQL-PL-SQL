-- employee package
create or replace package emp_pkg as
  g_max_sal constant number := 10000;
  procedure hire(p_name varchar2, p_sal number);
  function get_sal(p_empno number) return number;
end emp_pkg;
/
create or replace package body emp_pkg as
  procedure hire(p_name varchar2, p_sal number) is
  begin
    insert into emp(empno, ename, sal) values (emp_seq.nextval, p_name, p_sal); /* new row */
  end hire;

  function get_sal(p_empno number) return number is
    v_sal number;
  begin
    select sal into v_sal from emp where empno = p_empno;
    return v_sal;
  end get_sal;
end emp_pkg;
/
create or replace trigger trg_emp_audit before insert or update on emp for each row
begin
  if inserting then :new.created_on := sysdate; end if;
  :new.updated_on := sysdate;
end;
/
create table leave_requests (id number generated always as identity primary key, emp_id number not null references emp(empno), start_date date, reason varchar2(200), status varchar2(10) default 'PENDING' check (status in ('PENDING','APPROVED')));
